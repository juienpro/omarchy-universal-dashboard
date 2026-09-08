import { z } from "zod";
import { irNode, nodeId, type IrNode } from "./components.js";

export const viewIr = z
  .object({
    irVersion: z.literal(1),
    title: z.string().min(1).max(120),
    datasets: z.array(z.string()).default([]),
    root: nodeId,
    nodes: z.record(nodeId, irNode),
  })
  .superRefine((view, ctx) => {
    if (!(view.root in view.nodes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Root node "${view.root}" does not exist`,
        path: ["root"],
      });
      return;
    }

    const boundDatasets = new Set<string>();
    const referenced = new Set<string>([view.root]);

    for (const [id, node] of Object.entries(view.nodes)) {
      const children = "children" in node ? node.children : [];
      for (const childId of children) {
        if (!(childId in view.nodes)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Node "${id}" references missing child "${childId}"`,
            path: ["nodes", id, "children"],
          });
        } else {
          referenced.add(childId);
        }
      }
      collectDatasets(node, boundDatasets);
    }

    for (const key of boundDatasets) {
      if (!view.datasets.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node binds dataset "${key}" which is not listed in view.datasets`,
          path: ["datasets"],
        });
      }
    }

    for (const id of Object.keys(view.nodes)) {
      if (!referenced.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node "${id}" is not reachable from root`,
          path: ["nodes", id],
        });
      }
    }

    if (hasCycle(view.nodes, view.root)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "View tree contains a cycle",
        path: ["nodes"],
      });
    }
  });

export type ViewIr = z.infer<typeof viewIr>;

export function parseViewIr(input: unknown): ViewIr {
  return viewIr.parse(input);
}

function collectDatasets(node: IrNode, into: Set<string>) {
  const props = node.props as Record<string, unknown>;
  if (typeof props.dataset === "string") into.add(props.dataset);
  if (node.type === "Button" && node.on?.click?.action === "dataset.refresh") {
    into.add(node.on.click.dataset);
  }
}

function hasCycle(nodes: Record<string, IrNode>, root: string): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = nodes[id];
    const children = node && "children" in node ? node.children : [];
    for (const child of children) {
      if (dfs(child)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return dfs(root);
}

export function inspectView(view: ViewIr): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = view.nodes[id];
    if (!node) {
      lines.push(`${"  ".repeat(depth)}<missing ${id}>`);
      return;
    }
    const extra = summarize(node);
    lines.push(`${"  ".repeat(depth)}${node.type}#${id}${extra ? ` ${extra}` : ""}`);
    if ("children" in node) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(view.root, 0);
  return lines.join("\n");
}

function summarize(node: IrNode): string {
  const p = node.props as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.height === "number") bits.push(`h=${p.height}`);
  if (typeof p.kind === "string") bits.push(p.kind);
  if (typeof p.dataset === "string") bits.push(p.dataset);
  if (typeof p.text === "string") bits.push(`"${p.text.slice(0, 40)}"`);
  if (typeof p.label === "string") bits.push(`"${p.label}"`);
  return bits.join(" ");
}

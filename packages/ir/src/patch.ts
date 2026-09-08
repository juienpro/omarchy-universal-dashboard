import { z } from "zod";
import { irNode, nodeId, type IrNode } from "./components.js";
import { parseViewIr, type ViewIr } from "./view.js";

export const patchOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    id: nodeId,
    path: z.string().min(1),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("move"),
    id: nodeId,
    parent: nodeId,
    index: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("setChildren"),
    id: nodeId,
    children: z.array(nodeId),
  }),
  z.object({
    op: z.literal("insert"),
    parent: nodeId,
    index: z.number().int().min(0),
    id: nodeId,
    node: irNode,
  }),
  z.object({
    op: z.literal("remove"),
    id: nodeId,
  }),
  z.object({
    op: z.literal("duplicate"),
    id: nodeId,
    newId: nodeId,
  }),
  z.object({
    op: z.literal("replace"),
    id: nodeId,
    node: irNode,
    /** When true (default), keep the previous children list on container nodes. Set false to take `node.children`. */
    keepChildren: z.boolean().optional().default(true),
  }),
]);

export type PatchOp = z.infer<typeof patchOp>;

export function applyPatch(view: ViewIr, ops: PatchOp[]): ViewIr {
  let next: ViewIr = structuredClone(view);
  for (const op of ops) {
    next = applyOp(next, op);
  }
  return parseViewIr(next);
}

function applyOp(view: ViewIr, op: PatchOp): ViewIr {
  switch (op.op) {
    case "set": {
      const node = mustNode(view, op.id);
      if (op.path === "children") {
        if (!Array.isArray(op.value) || op.value.some((v) => typeof v !== "string")) {
          throw new PatchError(`set children expects string[] on "${op.id}"`);
        }
        return setChildren(view, op.id, op.value as string[]);
      }
      const props = { ...(node.props as Record<string, unknown>), [op.path]: op.value };
      const updated = irNode.parse({ ...node, props });
      return { ...view, nodes: { ...view.nodes, [op.id]: updated } };
    }
    case "move": {
      if (op.id === view.root) throw new PatchError("Cannot move the root node");
      const without = removeFromParents(view, op.id);
      return insertChild(without, op.parent, op.id, op.index);
    }
    case "setChildren": {
      return setChildren(view, op.id, op.children);
    }
    case "insert": {
      if (op.id in view.nodes) throw new PatchError(`Node "${op.id}" already exists`);
      const withNode = { ...view, nodes: { ...view.nodes, [op.id]: op.node } };
      return insertChild(withNode, op.parent, op.id, op.index);
    }
    case "remove": {
      if (op.id === view.root) throw new PatchError("Cannot remove the root node");
      const without = removeFromParents(view, op.id);
      const drop = collectDescendants(without, op.id);
      drop.add(op.id);
      const nodes = { ...without.nodes };
      for (const id of drop) delete nodes[id];
      return { ...without, nodes };
    }
    case "duplicate": {
      if (op.newId in view.nodes) throw new PatchError(`Node "${op.newId}" already exists`);
      const source = mustNode(view, op.id);
      const cloned = structuredClone(source) as IrNode;
      if ("children" in cloned) cloned.children = [];
      const parentId = findParent(view, op.id);
      if (!parentId) throw new PatchError("Cannot duplicate the root node");
      const withNode = { ...view, nodes: { ...view.nodes, [op.newId]: cloned } };
      const parent = mustNode(withNode, parentId);
      const children = "children" in parent ? [...parent.children] : [];
      const index = children.indexOf(op.id) + 1;
      return insertChild(withNode, parentId, op.newId, index);
    }
    case "replace": {
      const previous = mustNode(view, op.id);
      const keepChildren = op.keepChildren !== false;
      let replacement: IrNode = op.node;
      if (keepChildren && "children" in previous && "children" in op.node) {
        replacement = { ...op.node, children: previous.children };
      }
      return { ...view, nodes: { ...view.nodes, [op.id]: irNode.parse(replacement) } };
    }
  }
}

function setChildren(view: ViewIr, parentId: string, childIds: string[]): ViewIr {
  const parent = mustNode(view, parentId);
  if (!("children" in parent)) {
    throw new PatchError(`Node "${parentId}" cannot have children`);
  }
  for (const childId of childIds) {
    if (!(childId in view.nodes)) {
      throw new PatchError(`Child "${childId}" does not exist`);
    }
    if (childId === parentId) {
      throw new PatchError(`Node "${parentId}" cannot contain itself`);
    }
  }
  if (new Set(childIds).size !== childIds.length) {
    throw new PatchError(`Duplicate child ids under "${parentId}"`);
  }

  let next = view;
  for (const childId of childIds) {
    next = removeFromParents(next, childId);
  }
  const updatedParent = mustNode(next, parentId);
  if (!("children" in updatedParent)) {
    throw new PatchError(`Node "${parentId}" cannot have children`);
  }
  return {
    ...next,
    nodes: {
      ...next.nodes,
      [parentId]: { ...updatedParent, children: [...childIds] } as IrNode,
    },
  };
}

function mustNode(view: ViewIr, id: string): IrNode {
  const node = view.nodes[id];
  if (!node) throw new PatchError(`Node "${id}" not found`);
  return node;
}

function findParent(view: ViewIr, id: string): string | null {
  for (const [parentId, node] of Object.entries(view.nodes)) {
    if ("children" in node && node.children.includes(id)) return parentId;
  }
  return null;
}

function removeFromParents(view: ViewIr, id: string): ViewIr {
  const nodes = { ...view.nodes };
  for (const [parentId, node] of Object.entries(nodes)) {
    if ("children" in node && node.children.includes(id)) {
      nodes[parentId] = { ...node, children: node.children.filter((c) => c !== id) };
    }
  }
  return { ...view, nodes };
}

function insertChild(view: ViewIr, parentId: string, childId: string, index: number): ViewIr {
  const parent = mustNode(view, parentId);
  if (!("children" in parent)) {
    throw new PatchError(`Node "${parentId}" cannot have children`);
  }
  const children = parent.children.filter((c) => c !== childId);
  const at = Math.min(index, children.length);
  children.splice(at, 0, childId);
  return {
    ...view,
    nodes: { ...view.nodes, [parentId]: { ...parent, children } },
  };
}

function collectDescendants(view: ViewIr, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (current: string) => {
    const node = view.nodes[current];
    if (!node || !("children" in node)) return;
    for (const child of node.children) {
      out.add(child);
      walk(child);
    }
  };
  walk(id);
  return out;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

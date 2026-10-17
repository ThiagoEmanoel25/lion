// Named exits of a node. A node kind that declares ports picks one at run time and
// the engine follows the edge with that port.
export const EDGE_PORTS = ['success', 'failure', 'reply', 'timeout'] as const;
export type EdgePort = typeof EDGE_PORTS[number];

export const NODE_PORTS: Readonly<Partial<Record<string, readonly EdgePort[]>>> = {
  webhook: ['success', 'failure'],
  ai: ['success', 'failure'],
  wait_response: ['reply', 'timeout'],
  pixel: ['success', 'failure']
};

export function nodePorts(kind: string): readonly EdgePort[] {
  return NODE_PORTS[kind] ?? [];
}

// Edges saved before ports existed have no port: they keep meaning "success".
export function edgePort(edge: { port?: EdgePort }): EdgePort {
  return edge.port ?? 'success';
}

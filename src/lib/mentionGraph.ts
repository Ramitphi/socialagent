export type UserRef = {
  fid: number;
  username: string | null;
  display_name: string | null;
  pfp_url: string | null;
};

export type GraphNode = {
  id: string;
  fid: number;
  username: string | null;
  display_name: string | null;
  pfp_url: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  label: string;
};

export type MentionGraphResult = {
  generated_at: string;
  graph_type: "directed_mentions";
  semantics: "edge B->A means B mentioned A";
  seed: UserRef;
  target: UserRef | null;
  stats: {
    node_count: number;
    edge_count: number;
    expanded_users: number;
    crawl_depth: number;
    casts_per_user: number;
  };
  degree: number | null;
  path: string[] | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type BuildMentionGraphArgs = {
  apiKey: string;
  seed: string;
  target?: string;
  depth: number;
  castsPerUser: number;
  pageSize: number;
  maxExpandedUsers: number;
};

const API_BASE = "https://api.neynar.com/v2/farcaster";

class NeynarClient {
  constructor(private readonly apiKey: string) {}

  async get(path: string, query: Record<string, string | number | boolean | null>) {
    const url = new URL(`${API_BASE}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Neynar ${response.status}: ${body}`);
    }

    return response.json();
  }

  async lookupUser(identifier: string): Promise<UserRef> {
    const raw = identifier.trim();

    if (/^\d+$/.test(raw)) {
      return this.lookupUserByFid(Number(raw));
    }

    const username = raw.replace(/^@/, "").toLowerCase();
    const data = await this.get("/user/by_username", { username });
    const user = data?.user;

    if (!user || typeof user.fid !== "number") {
      throw new Error(`Could not resolve user '${identifier}'`);
    }

    return {
      fid: user.fid,
      username: user.username ?? username,
      display_name: user.display_name ?? null,
      pfp_url: extractPfpUrl(user),
    };
  }

  async lookupUserByFid(fid: number): Promise<UserRef> {
    const data = await this.get("/user/bulk", { fids: fid });
    const users = Array.isArray(data?.users) ? data.users : [];
    const user = users[0];

    if (!user || typeof user.fid !== "number") {
      throw new Error(`Could not resolve fid '${fid}'`);
    }

    return {
      fid: user.fid,
      username: user.username ?? null,
      display_name: user.display_name ?? null,
      pfp_url: extractPfpUrl(user),
    };
  }

  async getUserCasts(fid: number, opts: { limit: number; cursor: string | null }) {
    return this.get("/feed/user/casts", {
      fid,
      limit: opts.limit,
      cursor: opts.cursor,
      include_replies: false,
      parent_url: "",
    });
  }
}

function ensureNode(nodes: Map<string, GraphNode>, fid: number, profile: Partial<UserRef> = {}) {
  const id = String(fid);
  const existing = nodes.get(id);

  if (!existing) {
    nodes.set(id, {
      id,
      fid,
      username: profile.username ?? null,
      display_name: profile.display_name ?? null,
      pfp_url: profile.pfp_url ?? null,
    });
    return;
  }

  if (!existing.username && profile.username) existing.username = profile.username;
  if (!existing.display_name && profile.display_name) existing.display_name = profile.display_name;
  if (!existing.pfp_url && profile.pfp_url) existing.pfp_url = profile.pfp_url;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractPfpUrl(user: unknown): string | null {
  const userObj = asObject(user);
  if (!userObj) return null;

  if (typeof userObj.pfp_url === "string") return userObj.pfp_url;

  const pfpObj = asObject(userObj.pfp);
  if (pfpObj && typeof pfpObj.url === "string") return pfpObj.url;

  return null;
}

function extractMentions(cast: unknown): UserRef[] {
  const output: UserRef[] = [];
  const castObj = asObject(cast);

  const profiles = castObj && Array.isArray(castObj.mentioned_profiles) ? castObj.mentioned_profiles : [];
  for (const profile of profiles) {
    const profileObj = asObject(profile);
    if (!profileObj || typeof profileObj.fid !== "number") continue;
    output.push({
      fid: profileObj.fid,
      username: typeof profileObj.username === "string" ? profileObj.username : null,
      display_name: typeof profileObj.display_name === "string" ? profileObj.display_name : null,
      pfp_url: extractPfpUrl(profileObj),
    });
  }

  const fids = castObj && Array.isArray(castObj.mentioned_fids) ? castObj.mentioned_fids : [];
  for (const fid of fids) {
    if (typeof fid !== "number") continue;
    output.push({ fid, username: null, display_name: null, pfp_url: null });
  }

  return output;
}

function shortestPathDirected(adjacency: Map<string, Set<string>>, source: string, target: string) {
  if (source === target) return [source];

  const queue: string[] = [source];
  const visited = new Set([source]);
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const next of neighbors) {
      if (visited.has(next)) continue;

      visited.add(next);
      parent.set(next, current);

      if (next === target) {
        const path = [target];
        let p = target;
        while (p !== source) {
          p = parent.get(p)!;
          path.push(p);
        }
        path.reverse();
        return path;
      }

      queue.push(next);
    }
  }

  return null;
}

async function hydrateMissingUsers(client: NeynarClient, nodes: GraphNode[]) {
  for (const node of nodes) {
    if (node.username) continue;

    try {
      const user = await client.lookupUserByFid(node.fid);
      node.username = user.username;
      node.display_name = node.display_name ?? user.display_name;
      node.pfp_url = node.pfp_url ?? user.pfp_url;
    } catch {
      // best effort only
    }
  }
}

export async function buildMentionGraph(args: BuildMentionGraphArgs): Promise<MentionGraphResult> {
  const client = new NeynarClient(args.apiKey);
  const seedUser = await client.lookupUser(args.seed);
  const targetUser = args.target ? await client.lookupUser(args.target) : null;

  const nodes = new Map<string, GraphNode>();
  const edgeWeights = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const visited = new Set<number>();
  const queue: Array<{ fid: number; level: number }> = [{ fid: seedUser.fid, level: 0 }];

  let expandedUsers = 0;
  ensureNode(nodes, seedUser.fid, seedUser);

  while (queue.length > 0 && expandedUsers < args.maxExpandedUsers) {
    const { fid, level } = queue.shift()!;
    if (visited.has(fid)) continue;
    visited.add(fid);
    expandedUsers += 1;

    let fetched = 0;
    let cursor: string | null = null;

    while (fetched < args.castsPerUser) {
      const remaining = args.castsPerUser - fetched;
      const limit = Math.max(1, Math.min(args.pageSize, remaining));
      const page = await client.getUserCasts(fid, { limit, cursor });

      const casts = Array.isArray(page?.casts) ? page.casts : [];
      if (casts.length === 0) break;

      for (const cast of casts) {
        fetched += 1;

        const mentions = extractMentions(cast);
        for (const mention of mentions) {
          ensureNode(nodes, mention.fid, mention);

          const source = String(fid);
          const target = String(mention.fid);
          const key = `${source}->${target}`;

          edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);

          if (!adjacency.has(source)) adjacency.set(source, new Set());
          adjacency.get(source)!.add(target);

          if (level < args.depth && !visited.has(mention.fid)) {
            queue.push({ fid: mention.fid, level: level + 1 });
          }
        }
      }

      const nextCursor = page?.next?.cursor;
      if (!nextCursor || typeof nextCursor !== "string") break;
      cursor = nextCursor;
    }
  }

  const edges: GraphEdge[] = [];
  for (const [key, weight] of edgeWeights.entries()) {
    const [source, target] = key.split("->");
    edges.push({ source, target, weight, label: String(weight) });
  }

  const nodeList = [...nodes.values()];
  await hydrateMissingUsers(client, nodeList);

  let path: string[] | null = null;
  let degree: number | null = null;

  if (targetUser) {
    path = shortestPathDirected(adjacency, String(seedUser.fid), String(targetUser.fid));
    degree = path ? path.length - 1 : null;
  }

  return {
    generated_at: new Date().toISOString(),
    graph_type: "directed_mentions",
    semantics: "edge B->A means B mentioned A",
    seed: seedUser,
    target: targetUser,
    stats: {
      node_count: nodeList.length,
      edge_count: edges.length,
      expanded_users: expandedUsers,
      crawl_depth: args.depth,
      casts_per_user: args.castsPerUser,
    },
    degree,
    path,
    nodes: nodeList,
    edges,
  };
}

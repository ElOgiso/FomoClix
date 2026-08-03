import { Container } from "@cloudflare/containers";

export class ZoraBotContainer extends Container {
  constructor(ctx, env) {
    super(ctx, env);
    this.defaultPort = 8080; 
  }

  static outboundByHost = {
    "d1.local": async (request, env, ctx) => {
      try {
        const body = await request.json();
        const { sql, params, method } = body;
        
        let result;
        if (method === "run") {
          result = await env.DB.prepare(sql).bind(...(params || [])).run();
        } else if (method === "all") {
          result = await env.DB.prepare(sql).bind(...(params || [])).all();
        } else if (method === "exec") {
          result = await env.DB.exec(sql);
        } else if (method === "batch") {
          const statements = sql.map((s, idx) => env.DB.prepare(s).bind(...(params[idx] || [])));
          result = await env.DB.batch(statements);
        } else {
          result = await env.DB.prepare(sql).bind(...(params || [])).all();
        }

        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  };
}

export default {
  async fetch(request, env) {
    const id = env.ZORA_BOT.idFromName("global-bot-instance");
    const container = env.ZORA_BOT.get(id);
    return container.fetch(request);
  },
};
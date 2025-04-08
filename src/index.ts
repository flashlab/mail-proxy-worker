import { WorkerMailer } from 'worker-mailer'

export interface Env {
  API_EMAIL: string;
  API_KEY: string;
  API_HOST: string;
  API_PORT: number;
  CF_TSKEY: string;
  FB_HOST: string;
  MSG_SUCCESS: string;
  DST_EMAIL: string;
}

export default {
  async fetch(request, env): Promise<Response> {

    /**
     * readRequestBody reads in the incoming request body
     * Use await readRequestBody(..) in an async function to get the string
     * @param {Request} request the incoming request to read from
     */
    async function readRequestBody(request: Request) {
      const contentType = request.headers.get("content-type");
      let body: any = {};
      if (contentType?.includes("application/json")) {
        const jsonData: any = await request.json();
        const { key, ...realbody } = jsonData;
        if (key == "pmm123") body = realbody;
      } else if (contentType?.includes("form-urlencoded")) {
        const formData = await request.formData();
        // Cloudflare Turnstile
        const token = formData.get('cf-turnstile-response');
        if (token) {
          let cformData: any = new FormData();
          cformData.append('secret', env.CF_TSKEY);
          cformData.append('response', token);
          cformData.append('remoteip', request.headers.get('CF-Connecting-IP'));
          const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            body: cformData,
            method: 'POST',
          });
          const outcome: any = await result.json();
          if (!outcome.success) {
            return body;
          }
          formData.delete('cf-turnstile-response');
        }

        for (const [key, value] of formData.entries()) {
          body[key] = value;
        }
      }
      return body;
    }

    async function mailerSend(body: any) {
      const { name, from, to, subject, text } = body;
      await WorkerMailer.send(
        {
          // WorkerMailerOptions
          host: env.API_HOST,
          port: env.API_PORT,
          authType: 'plain',
          secure: true,
          credentials: {
            username: env.API_EMAIL,
            password: env.API_KEY,
          },
        },
        {
          // EmailOptions
          from: { name: 'website', email: env.API_EMAIL },
          to: to || env.DST_EMAIL,
          subject: `From website: ${subject}`,
          text: `Email from ${from} by ${name}\n${text}`
        },
      );
    }

    if (request.method === "POST") {
      const reqBody = await readRequestBody(request);
      if (Object.keys(reqBody).length !== 0) {
        if (!reqBody.force) {
          let newHeaders: any = {}
          // Only pass through a subset of headers
          const proxyHeaders = ["Accept",
            "Accept-Encoding",
            "Accept-Language",
            "Referer",
            "User-Agent",
            "origin"];
          for (let name of proxyHeaders) {
            let value = request.headers.get(name);
            if (value) {
              newHeaders[name] = value;
            }
          }
          newHeaders['Content-Type'] = 'application/json';
          try {
            const response = await fetch(env.FB_HOST, {
              method: 'POST',
              headers: newHeaders,
              body: JSON.stringify(reqBody)
            });
            if (!response.ok) {
              throw new Error(`Response status: ${response.status}`);
            }
            return new Response(env.MSG_SUCCESS, { status: 200 });
          } catch (error: any) {
            console.error(error.message);
          }
        }
        // fallback to worker-mailer
        mailerSend(reqBody);
        return new Response('Sended!', { status: 200 });
      } else { return new Response('Forbidden', { status: 403 }); }
    } else { return new Response('Method Not Allowed', { status: 405 }); }
  },
};

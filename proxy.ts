import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSupabaseAuthConfig } from "./lib/supabase/auth-config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = resolveSupabaseAuthConfig(process.env);

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          const previousCookies = response.cookies.getAll();
          response = NextResponse.next({ request });

          for (const cookie of previousCookies) {
            response.cookies.set(cookie);
          }

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();

  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Pragma", "no-cache");
  if (process.env.TEST_RUN_ID) {
    response.headers.set("x-test-server-run-id", process.env.TEST_RUN_ID);
  }

  return response;
}

export const config = {
  matcher: ["/login", "/dashboard/:path*"],
};

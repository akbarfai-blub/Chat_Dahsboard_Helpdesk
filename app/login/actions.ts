"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  if (
    typeof emailValue !== "string" ||
    typeof passwordValue !== "string" ||
    !emailValue.trim() ||
    !passwordValue.trim()
  ) {
    redirect("/login?error=required");
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: emailValue.trim(),
    password: passwordValue,
  });

  if (error) {
    redirect("/login?error=login");
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect("/dashboard?error=logout");
  }

  redirect("/login");
}

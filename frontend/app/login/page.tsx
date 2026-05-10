"use client";

import { AppClient } from "../AppClient";

export default function LoginPage() {
  return <AppClient mode="auth" initialSection="contacts" />;
}

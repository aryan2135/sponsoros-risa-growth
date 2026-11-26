import { createDbForTests } from "@/lib/db/client";
export const testDb = () => createDbForTests("memory://");
export const IST = (s: string) => new Date(s + "+05:30").getTime();
export const PRE = IST("2025-04-11T23:59:59");
export const END = IST("2025-04-20T23:59:59");

import { DomainError } from "./errors.ts";

export class Branch {
  readonly value: string;
  private constructor(value: string) {
    this.value = value;
  }
  static of(name: string): Branch {
    if (typeof name !== "string" || name.trim() === "") throw new DomainError("invalid", "branch must not be empty");
    return new Branch(name);
  }
  toString(): string {
    return this.value;
  }
}

export class CommitSha {
  readonly value: string;
  private constructor(value: string) {
    this.value = value;
  }
  static of(s: string): CommitSha {
    if (typeof s !== "string" || !/^[0-9a-f]{7,40}$/i.test(s)) throw new DomainError("invalid", `invalid commit: ${s}`);
    return new CommitSha(s);
  }
  toString(): string {
    return this.value;
  }
}

const RESERVED = new Set(["user", "system"]);

export class AgentName {
  readonly value: string;
  private constructor(value: string) {
    this.value = value;
  }
  static of(s: string): AgentName {
    if (typeof s !== "string" || !/^[a-z0-9._-]{1,40}$/.test(s)) {
      throw new DomainError("invalid", "agent name must be 1-40 chars of a-z 0-9 . _ -");
    }
    if (RESERVED.has(s)) throw new DomainError("invalid", `agent name "${s}" is reserved`);
    return new AgentName(s);
  }
  toString(): string {
    return this.value;
  }
}

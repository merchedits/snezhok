const LICENSE_IDS = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
]);

const EXCEPTION_IDS = new Set([
  "Classpath-exception-2.0",
  "GCC-exception-3.1",
  "LLVM-exception",
  "OpenSSL-exception",
]);

const LICENSE_REFERENCE = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;

function tokenize(expression) {
  const tokens = [];
  let offset = 0;
  while (offset < expression.length) {
    const whitespace = /^\s+/.exec(expression.slice(offset));
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const token = /^(?:\(|\)|AND\b|OR\b|WITH\b|[A-Za-z0-9.+:-]+)/.exec(expression.slice(offset));
    if (!token) throw new Error(`unexpected SPDX token at column ${offset + 1}`);
    tokens.push(token[0]);
    offset += token[0].length;
  }
  return tokens;
}

/**
 * Parses the subset of SPDX 2.3 expressions accepted by this repository.
 * The identifier allow-list is intentionally reviewed and expanded only when
 * a locked dependency introduces a real SPDX identifier.
 */
export function parseSpdxExpression(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("SPDX expression is empty");
  const tokens = tokenize(value.trim());
  let index = 0;

  const peek = () => tokens[index];
  const consume = (expected) => {
    const token = tokens[index];
    if (expected && token !== expected) throw new Error(`expected ${expected}, received ${token ?? "end of expression"}`);
    index += 1;
    return token;
  };

  const parsePrimary = () => {
    if (peek() === "(") {
      consume("(");
      parseOr();
      consume(")");
      return { compound: true };
    }
    const identifier = consume();
    if (!identifier || ["AND", "OR", "WITH", ")"].includes(identifier)) throw new Error(`expected SPDX license identifier, received ${identifier ?? "end of expression"}`);
    if (!LICENSE_IDS.has(identifier) && !LICENSE_REFERENCE.test(identifier)) throw new Error(`unknown SPDX license identifier '${identifier}'`);
    return { compound: false };
  };

  const parseWith = () => {
    const primary = parsePrimary();
    if (peek() !== "WITH") return;
    if (primary.compound) throw new Error("WITH cannot apply to a compound SPDX expression");
    consume("WITH");
    const exception = consume();
    if (!EXCEPTION_IDS.has(exception)) throw new Error(`unknown SPDX exception identifier '${exception ?? ""}'`);
  };

  const parseAnd = () => {
    parseWith();
    while (peek() === "AND") {
      consume("AND");
      parseWith();
    }
  };

  function parseOr() {
    parseAnd();
    while (peek() === "OR") {
      consume("OR");
      parseAnd();
    }
  }

  parseOr();
  if (index !== tokens.length) throw new Error(`unexpected SPDX token '${tokens[index]}'`);
  return { expression: value.trim(), licenseIds: [...LICENSE_IDS] };
}

export function isSpdxLicenseId(value) {
  return LICENSE_IDS.has(value) || LICENSE_REFERENCE.test(value);
}


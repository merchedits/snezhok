export const usernamePattern = /^[a-zA-Z0-9_.-]+$/;

export function validUsername(value: string): boolean {
  const username = value.trim();
  return username.length >= 3 && username.length <= 32 && usernamePattern.test(username);
}

export function validEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 256;
}

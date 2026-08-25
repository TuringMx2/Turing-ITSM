import { isRole, roleHome, roleLabels, type Role } from "./rbac";

export type MockUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  tenantId: string | null;
  tenantName: string | null;
};

export type MockSession = Omit<MockUser, "password">;

const STORAGE_KEY = "turing_itsm_mock_session";

export const testUsers: MockUser[] = [
  {
    id: "usr_support_agent",
    email: "support.agent@test.com",
    name: "Support Agent Demo",
    password: "password123",
    role: "support_agent",
    tenantId: null,
    tenantName: null,
  },
  {
    id: "usr_admin",
    email: "admin@test.com",
    name: "Admin Demo",
    password: "password123",
    role: "admin",
    tenantId: null,
    tenantName: null,
  },
];

function toSession(user: MockUser): MockSession {
  const { password: _password, ...session } = user;
  void _password;
  return session;
}

export function loginWithMockUser(email: string, password: string): MockSession | null {
  const normalizedEmail = email.trim().toLowerCase();
  const user = testUsers.find(
    (candidate) => candidate.email === normalizedEmail && candidate.password === password,
  );

  if (!user) {
    return null;
  }

  const session = toSession(user);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

function isMockSession(value: unknown): value is MockSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<MockSession>;

  return (
    typeof session.id === "string" &&
    typeof session.email === "string" &&
    typeof session.name === "string" &&
    isRole(session.role) &&
    (typeof session.tenantId === "string" || session.tenantId === null) &&
    (typeof session.tenantName === "string" || session.tenantName === null)
  );
}

export function getMockSession(): MockSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isMockSession(parsed)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function logoutMockUser() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getRoleHome(role: Role) {
  return roleHome[role];
}

export function getRoleLabel(role: Role) {
  return roleLabels[role];
}

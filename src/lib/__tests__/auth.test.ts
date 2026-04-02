import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

vi.mock("server-only", () => ({}));

const mockSet = vi.fn();
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ set: mockSet, get: mockGet }),
}));

vi.mock("jose", () => ({
  SignJWT: vi.fn(),
  jwtVerify: vi.fn(),
}));

const mockSign = vi.fn().mockResolvedValue("mock-token");
const mockChain = {
  setProtectedHeader: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  setIssuedAt: vi.fn().mockReturnThis(),
  sign: mockSign,
};

describe("createSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SignJWT).mockImplementation(() => mockChain as any);
    mockSign.mockResolvedValue("mock-token");
  });

  async function callCreateSession() {
    const { createSession } = await import("../auth");
    await createSession("user-123", "test@example.com");
  }

  it("calls SignJWT with correct payload", async () => {
    await callCreateSession();
    expect(SignJWT).toHaveBeenCalledWith({
      userId: "user-123",
      email: "test@example.com",
      expiresAt: expect.any(Date),
    });
  });

  it("sets protected header with alg HS256", async () => {
    await callCreateSession();
    expect(mockChain.setProtectedHeader).toHaveBeenCalledWith({ alg: "HS256" });
  });

  it("sets expiration time to 7d", async () => {
    await callCreateSession();
    expect(mockChain.setExpirationTime).toHaveBeenCalledWith("7d");
  });

  it("sets cookie name to auth-token", async () => {
    await callCreateSession();
    expect(mockSet).toHaveBeenCalledWith(
      "auth-token",
      "mock-token",
      expect.any(Object)
    );
  });

  it("sets cookie options httpOnly, sameSite, path", async () => {
    await callCreateSession();
    const options = mockSet.mock.calls[0][2];
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("sets secure: false outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await callCreateSession();
    const options = mockSet.mock.calls[0][2];
    expect(options.secure).toBe(false);
    vi.unstubAllEnvs();
  });

  it("sets secure: true in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await callCreateSession();
    const options = mockSet.mock.calls[0][2];
    expect(options.secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it("sets cookie expires ~7 days from now", async () => {
    const before = Date.now();
    await callCreateSession();
    const after = Date.now();
    const options = mockSet.mock.calls[0][2];
    const expires: Date = options.expires;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callGetSession() {
    const { getSession } = await import("../auth");
    return getSession();
  }

  it("returns null when no cookie is present", async () => {
    mockGet.mockReturnValue(undefined);
    const result = await callGetSession();
    expect(result).toBeNull();
  });

  it("returns the session payload when token is valid", async () => {
    const payload = { userId: "user-123", email: "test@example.com", expiresAt: new Date() };
    mockGet.mockReturnValue({ value: "valid-token" });
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);
    const result = await callGetSession();
    expect(result).toEqual(payload);
  });

  it("calls jwtVerify with the cookie token", async () => {
    mockGet.mockReturnValue({ value: "some-token" });
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { userId: "u1", email: "a@b.com" } } as any);
    await callGetSession();
    expect(jwtVerify).toHaveBeenCalledWith("some-token", expect.anything());
  });

  it("returns null when jwtVerify throws", async () => {
    mockGet.mockReturnValue({ value: "bad-token" });
    vi.mocked(jwtVerify).mockRejectedValue(new Error("invalid signature"));
    const result = await callGetSession();
    expect(result).toBeNull();
  });
});

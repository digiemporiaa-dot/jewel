/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

/**
 * One form for signing in and signing up.
 *
 * Two pages with a text link between them let a returning customer who had
 * forgotten their account make a second one. The rules below are what stops
 * that, and one of them is about what the screen must *not* say.
 */

// Declared inside the factories: `vi.mock` is hoisted above every `const` in
// this file, so a top-level spy would not exist yet when the factory runs.
const { sendSignupOtp, verifySignupOtp, completeSignup } = vi.hoisted(() => ({
  sendSignupOtp: vi.fn(), verifySignupOtp: vi.fn(), completeSignup: vi.fn(),
}));
const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/app/(storefront)/signup/actions', () => ({ sendSignupOtp, verifySignupOtp, completeSignup }));

import AccountLogin from '@/app/(storefront)/my-account/AccountLogin';

beforeEach(() => {
  sendSignupOtp.mockReset().mockResolvedValue({ ok: true });
  verifySignupOtp.mockReset();
  completeSignup.mockReset();
  refresh.mockReset();
  push.mockReset();
});
afterEach(cleanup);

const email = () => screen.getByLabelText(/Email address/i) as HTMLInputElement;
const loginBtn = () => screen.getByRole('button', { name: /Send login code/i });
const createBtn = () => screen.getByRole('button', { name: /Create account/i });

async function reachCode(button: () => HTMLElement, address = 'ananya@example.com') {
  render(<AccountLogin />);
  fireEvent.change(email(), { target: { value: address } });
  fireEvent.click(button());
  await waitFor(() => screen.getByLabelText(/Enter the code/i));
}

async function enterCode(code = '123456') {
  fireEvent.change(screen.getByLabelText(/Enter the code/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /Verify and continue/i }));
}

describe('the two buttons', () => {
  it('are both real buttons, not a button and a link', () => {
    render(<AccountLogin />);
    expect(loginBtn().tagName).toBe('BUTTON');
    expect(createBtn().tagName).toBe('BUTTON');
  });

  it('carry equal weight — one filled, one outlined, same size', () => {
    // A first-time customer offered a tiny link under a big button reads the
    // link as the wrong door.
    render(<AccountLogin />);
    expect(loginBtn().className).toContain('btn-primary');
    expect(createBtn().className).toContain('btn-outline');
    for (const b of [loginBtn(), createBtn()]) {
      expect(b.className).toContain('w-full');
      expect(b.className).toContain('h-12');
    }
  });

  it('give the outlined one a boundary that meets WCAG 1.4.11', () => {
    // btn-outline's default stone edge is 1.69:1 on white. For a button whose
    // only visible boundary is that edge, the bar is 3:1 — velvet is 13.1:1.
    render(<AccountLogin />);
    expect(createBtn().className).toContain('border-velvet');
  });

  it('explain the difference in a plain sentence', () => {
    render(<AccountLogin />);
    expect(screen.getByText(/New here\? Create an account to save your details and track orders/i)).toBeTruthy();
  });

  it('stay disabled until the address looks like one', () => {
    render(<AccountLogin />);
    expect((loginBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(email(), { target: { value: 'ananya@example.com' } });
    expect((loginBtn() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('signing in an existing customer', () => {
  it('sends a code and then signs them straight in', async () => {
    verifySignupOtp.mockResolvedValue({ ok: true, existingAccount: true, profileComplete: true });
    await reachCode(loginBtn);
    expect(sendSignupOtp).toHaveBeenCalledWith('ananya@example.com');
    await enterCode();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Straight into their account: nothing left to ask them for.
    expect(push).not.toHaveBeenCalled();
  });
});

describe('a new customer who pressed the wrong button', () => {
  it('is carried on to the details form rather than sent back', async () => {
    // "No account found — would you like to create one?" is a dead end and an
    // oracle. Continuing is both kinder and safer.
    verifySignupOtp.mockResolvedValue({ ok: true, existingAccount: false, profileComplete: false });
    await reachCode(loginBtn);
    await enterCode();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signup'));
  });
});

describe('an existing customer who pressed Create account', () => {
  it('is told so on the next screen, and signed in — never given a second account', async () => {
    verifySignupOtp.mockResolvedValue({ ok: true, existingAccount: true, profileComplete: false });
    await reachCode(createBtn);
    await enterCode();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signup?returning=1'));
    // One row, reached by verifying: the panel never asks the server to create.
    expect(completeSignup).not.toHaveBeenCalled();
  });

  it('is signed straight in when there is nothing missing', async () => {
    verifySignupOtp.mockResolvedValue({ ok: true, existingAccount: true, profileComplete: true });
    await reachCode(createBtn);
    await enterCode();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('nothing before the code says whether the address is known here', () => {
  it('shows the same screen either way', async () => {
    // An anonymous visitor must not be able to test a list of addresses and
    // learn who buys jewellery from this shop.
    await reachCode(loginBtn, 'stranger@example.com');
    const text = document.body.innerText || document.body.textContent || '';
    expect(text).not.toMatch(/no account found/i);
    expect(text).not.toMatch(/already have an account/i);
    expect(text).toMatch(/We sent a six-digit code/i);
  });

  it('sends a code for an unknown address exactly as for a known one', async () => {
    await reachCode(createBtn, 'stranger@example.com');
    expect(sendSignupOtp).toHaveBeenCalledWith('stranger@example.com');
  });
});

describe('the flow is one screen, not two pages', () => {
  const panel = readFileSync(join(__dirname, '..', 'app/(storefront)/my-account/AccountLogin.tsx'), 'utf8');
  const signupPage = readFileSync(join(__dirname, '..', 'app/(storefront)/signup/page.tsx'), 'utf8');

  it('offers no second front door', () => {
    // The old "First time here? Create an account" link is what let a returning
    // customer start a second account.
    expect(panel).not.toContain('href="/signup"');
    expect(panel).not.toMatch(/First time here/i);
  });

  it('navigates deliberately rather than being torn off screen', () => {
    // Setting the session cookie in a server action makes Next re-render this
    // route, which then shows the account page. A details step rendered inside
    // the panel would vanish the instant it appeared.
    expect(panel).toContain("router.push(res.existingAccount && intent === 'signup' ? '/signup?returning=1' : '/signup')");
  });

  it('turns /signup away when there is no session to complete', () => {
    expect(signupPage).toContain("if (!customer) redirect('/my-account')");
  });

  it('has exactly one definition of the details fields', () => {
    // The page and the panel used to hold their own copy, which is how two
    // forms that are meant to be the same start to differ.
    const shared = readFileSync(join(__dirname, '..', 'components/auth/ProfileDetailsForm.tsx'), 'utf8');
    expect(shared).toContain('Date of birth');
    expect(signupPage).not.toContain('Date of birth');
    expect(panel).not.toContain('Date of birth');
  });
});

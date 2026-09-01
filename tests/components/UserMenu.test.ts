import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UserMenu Component', () => {
  const userMenuPath = path.join(process.cwd(), 'components/UserMenu.tsx');
  const userMenuContent = fs.readFileSync(userMenuPath, 'utf-8');

  it('should have a Settings link', () => {
    expect(userMenuContent).toContain('Settings');
  });

  it('should link Settings to /settings', () => {
    expect(userMenuContent).toContain('href="/settings"');
  });

  it('should include SignOutButton', () => {
    expect(userMenuContent).toContain('SignOutButton');
    expect(userMenuContent).toContain('<SignOutButton');
  });

  it('should have a dropdown menu structure', () => {
    expect(userMenuContent).toContain('Signed in as');
    expect(userMenuContent).toContain('isOpen');
  });
});

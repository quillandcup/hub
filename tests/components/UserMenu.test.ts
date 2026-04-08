import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Integration tests for UserMenu component
 * These tests verify the component structure contains required elements
 */
describe('UserMenu Component', () => {
  const userMenuPath = path.join(process.cwd(), 'app/dashboard/UserMenu.tsx');
  const userMenuContent = fs.readFileSync(userMenuPath, 'utf-8');

  it('should have an Edit Profile link', () => {
    // Check that the component includes an "Edit Profile" link
    expect(userMenuContent).toContain('Edit Profile');
  });

  it('should link Edit Profile to /dashboard/profile', () => {
    // Check that the link points to /dashboard/profile
    expect(userMenuContent).toContain('/dashboard/profile');
  });

  it('should still include SignOutButton', () => {
    // Verify SignOutButton is still imported and used
    expect(userMenuContent).toContain('SignOutButton');
    expect(userMenuContent).toContain('<SignOutButton');
  });

  it('should have a dropdown menu structure', () => {
    // Verify the dropdown structure exists
    expect(userMenuContent).toContain('Signed in as');
    expect(userMenuContent).toContain('isOpen');
  });

  it('should not have Edit Profile commented out', () => {
    // Ensure the Edit Profile link is not commented
    const editProfileSection = userMenuContent.match(/Edit Profile/g);
    expect(editProfileSection).toBeTruthy();

    // Check that it's not within a comment block
    const commentedEditProfile = userMenuContent.match(/\/\*[\s\S]*?Edit Profile[\s\S]*?\*\//);
    expect(commentedEditProfile).toBeNull();
  });
});

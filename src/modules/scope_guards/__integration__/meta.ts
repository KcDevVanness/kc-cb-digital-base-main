/**
 * Scope-guard integration metadata.
 *
 * The specs exercise the installed auth admin commands (`auth.users.create`,
 * `auth.role-acl.update`, `auth.user-acl.update`) through the real HTTP surface,
 * so both owning modules must be present.
 */
export const dependsOnModules = ['auth', 'directory']

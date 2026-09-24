/**
 * Jest config for the verification harness: runs the PATCHED upstream test file
 * against the PATCHED component inside `.work/`, reusing this app's transformer,
 * setup file and installed dependencies. Not part of the app's own test suite
 * (`jest.config.cjs` roots at `<rootDir>/src`).
 */
const path = require('path')

const appRoot = path.resolve(__dirname, '..', '..', '..', '..')

module.exports = {
  rootDir: path.join(__dirname, '.work'),
  roots: ['<rootDir>/packages'],
  testEnvironment: 'jsdom',
  testTimeout: 30000,
  setupFilesAfterEnv: [path.join(appRoot, 'jest.setup.ts')],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      path.join(appRoot, 'scripts', 'jest-mikroorm-transformer.cjs'),
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@open-mercato|@mikro-orm|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
}

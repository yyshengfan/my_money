module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  testPathIgnorePatterns: ['<rootDir>/test/fixtures'],
  coveragePathIgnorePatterns: ['<rootDir>/test/'],
};
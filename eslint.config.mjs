// ESLint 9 flat config minimo (task 18). Sem Prettier; regras iniciais pequenas.
import tseslint from 'typescript-eslint';

// Stub: comentarios `eslint-disable react-hooks/...` existentes no codigo nao quebram o lint.
const reactHooksStub = { rules: { 'exhaustive-deps': { meta: { schema: [] }, create: () => ({}) } } };

const rules = {
  // Legado: ~22 ocorrencias (web/seed) -> warn para nao reescrever codigo; subir para error depois de corrigir.
  '@typescript-eslint/no-floating-promises': 'warn',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'e2e/results/**',
      'e2e/report/**',
      'e2e/screenshots/**',
      '**/*.d.ts',
      '**/*.config.{js,cjs,mjs,ts}',
      'sites/**',
      'scripts/**',
      'apps/api/scripts/**',
    ],
  },
  {
    files: ['apps/*/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooksStub },
    rules,
  },
  {
    // packages/* nao tem tsconfig proprio: usa tsconfig.eslint.json da raiz.
    files: ['packages/*/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooksStub },
    rules,
  },
);

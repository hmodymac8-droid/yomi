export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (
      err?.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('.') || specifier.startsWith('/')) &&
      !/\.(ts|js|mjs|cjs|json|node)$/.test(specifier)
    ) {
      return await nextResolve(specifier + '.ts', context)
    }
    throw err
  }
}

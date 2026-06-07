/** Force a single @solana/web3.js version across all packages (fixes jito-ts + Node 24). */
function readPackage(pkg) {
  if (pkg.name === 'jito-ts' && pkg.dependencies?.['@solana/web3.js']) {
    pkg.dependencies['@solana/web3.js'] = '1.98.4';
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };

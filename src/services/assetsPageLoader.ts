type AssetsPageModule = typeof import("@/pages/Assets");

let assetsPagePromise: Promise<AssetsPageModule> | null = null;

export function loadAssetsPage(): Promise<AssetsPageModule> {
  assetsPagePromise ??= import("@/pages/Assets").catch((error) => {
    assetsPagePromise = null;
    throw error;
  });
  return assetsPagePromise;
}

export function preloadAssetsPage() {
  void loadAssetsPage().catch(() => {});
}

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Perkakas Claude Code, bukan kode aplikasi: hook & skill ditulis CommonJS (require/module.exports)
    // karena memang dijalankan Node di luar bundler. Aturan TypeScript/React di config ini tak
    // berlaku untuk mereka, dan tanpa pengecualian ini `npm run lint` menyala merah oleh 17 error
    // no-require-imports yang tak satu pun bisa "diperbaiki" tanpa merusak fungsinya.
    ".claude/**",
  ]),

  // react-hooks/set-state-in-effect: PERINGATAN, bukan error.
  //
  // Aturan ini datang dari React Compiler plugin dan melarang setState di dalam useEffect secara
  // menyeluruh. Sebelas kemunculannya di project ini sudah ditelusuri satu per satu pada 2026-09-07,
  // dan TAK SATU PUN merupakan bug — semuanya justru cara yang benar untuk kasusnya:
  //
  //   HeroStats.tsx            animasi count-up requestAnimationFrame (setState per frame = intinya)
  //   HeaderSearch.tsx         fetch saran ber-AbortController (hasil async harus masuk state)
  //   ValuePropositionBanner   IntersectionObserver reveal sekali
  //   ReviewProductCard.tsx    siklus hidup URL.createObjectURL + revoke di cleanup
  //   RecentlyViewed.tsx       baca localStorage saat mount (API browser, tak ada saat SSR)
  //   track-order / cancel-order / review   auto-recognize cookie tamu saat mount
  //   CartItemRow.tsx          sinkronisasi draft ketikan dengan quantity dari cookie
  //   oms/dashboard/orders     sinkronisasi filter dengan query string
  //
  // Menaikkannya jadi error berarti menulis ulang animasi, observer, dan alur fetch yang sudah
  // benar hanya demi memuaskan aturan — risiko regresi nyata, manfaat keamanan nol. Dibiarkan
  // sebagai peringatan supaya tetap terlihat dan bisa dicicil saat komponennya memang disentuh.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;

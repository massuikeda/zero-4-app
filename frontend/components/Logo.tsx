/** AWASERU のロゴ（アイコン＋文字）。画像は public/logo.png（背景は透明）。白い背景の上で使う。 */

export function Logo() {
  return (
    // 小さな画像1枚なので、Next.js の画像最適化は通さずそのまま表示する
    // eslint-disable-next-line @next/next/no-img-element
    <img className="logo-img" src="/logo.png" alt="AWASERU" width={199} height={40} />
  );
}

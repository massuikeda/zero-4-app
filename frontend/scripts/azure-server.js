/**
 * Azure App Service での起動ファイル（デプロイのとき server.js という名前で置かれる）。
 *
 * Next.js は、動いているあいだに表示したページの控えを .next/server/route-cache に保存する。
 * App Service へのデプロイは新しいファイルを上書きするだけで、このフォルダは消さない。
 * そのままだと、新しいプログラムが起動しても前のデプロイの控え（古い画面）を配り続けてしまう。
 * そこで、起動のたびに控えを消してから、Next.js 本体（next-server.js）を起動する。
 */
const fs = require("fs");
const path = require("path");

fs.rmSync(path.join(__dirname, ".next", "server", "route-cache"), { recursive: true, force: true });

require("./next-server.js");

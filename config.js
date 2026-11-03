// 投稿サイトの設定。GAS をデプロイし直して URL が変わったら、ここを書き換える
window.NB_POST_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxvDlnjV5NWtQr2zzgDBxqReNJYN4pzWH5RJsQ3hfi16rPLWJH4ZLaInbDdEKKLOOAI2w/exec',      // ウェブアプリの URL（…/exec）。gas/Code.gs のコメント参照
  LIFF_ID: '2012312496-3Cdhjxc5',      // LINE Developers で作る「naoblock 投稿サイト」の LIFF ID（endpoint は https://post.naoblock.jp/）
  BUILDER_URL: 'https://builder-3d.naoblock.jp/',   // 「組み立てる」で開く 3D 組立ガイド（?post=作品番号 を付けて開く）
  SITE_URL: 'https://post.naoblock.jp/',
};

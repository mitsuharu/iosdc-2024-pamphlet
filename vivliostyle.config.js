module.exports = {
    title: 'iOS デバイスから始める Bluetooth 制御の業務用サーマルプリンター対応アプリの作り方',
    author: '江本光晴',
    language: 'ja',
    size: 'A4',
    theme: [
      '@vivliostyle/theme-techbook',
      'theme/custom_theme.css',
      'theme/styles.css',
    ],
    entry: [
      'index.md',
    ],
    entryContext: './manuscripts',
    output: [
      './output/output.pdf',
    ],
    workspaceDir: '.vivliostyle',
    toc: false,
    cover: undefined,
    vfm: {
      hardLineBreaks: false,
      disableFormatHtml: false,
    },
  }
  
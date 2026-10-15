# Session summary fonts

Exports use these bundled fonts without consulting host fonts or a remote font service.
The original binaries are unchanged. Both are licensed under SIL Open Font License 1.1;
the adjacent license files and the fonts' embedded copyright notices travel with distributions.
Embedding them does not change the license of exported documents.

| Asset                       | Upstream revision and source                                                                                                                                                                  | SHA-256                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `NotoSansCJKjp-Regular.otf` | Noto Sans CJK 2.004, [Sans2.004 original](https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf)                                         | `68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5` |
| `NotoEmoji.ttf`             | [google/fonts commit 8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf) | `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551` |

Noto Sans CJK contains accented Latin and all four supported CJK languages.
The renderer selects localized CJK forms by language. Noto Emoji supplies a monochrome
fallback for emoji in authored text. Unsupported glyphs produce an explicit export error.

License sources: [Noto Sans CJK OFL](https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE)
and [Noto Emoji OFL](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoemoji/OFL.txt).

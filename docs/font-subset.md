# 폰트 서브셋 방법

원본 A고딕 ttf 는 각 3.6MB(글리프 18,194개)라 그대로 인라인할 수 없다.
상용 한글만 남겨 woff2 로 변환해 쓴다.

## 필요 도구

```bash
pip install fonttools brotli
```

## 현재 설정 (상용 2,346자 · 합 235KB)

`a고딕12` → 400(본문), `a고딕16` → 700(강조)으로 배정했다.
두 파일 모두 OS/2 weight 가 400으로 되어 있어 파일명만으로는 구분되지 않는다.
실제 획 굵기를 재서 확인한 결과다 ('가' 글리프 면적 141,817 vs 235,711).

```bash
# 상용 한글 목록은 ks_hangul.txt 에 보관
KS=$(python3 -c "print(','.join(f'U+{ord(c):04X}' for c in open('ks_hangul.txt').read().strip()))")
BASE="U+0020-007E,U+00B0,U+00B7,U+00D7,U+2018-201D,U+2022,U+2026,U+20A9,U+25A0,U+25CF,U+3000-3003,U+FF01,U+FF08-FF09,U+2103"

pyftsubset a고딕12.ttf --unicodes="$BASE,$KS" --layout-features='' \
  --flavor=woff2 --output-file=src/fonts/agothic-400.woff2 \
  --no-hinting --desubroutinize --drop-tables+=DSIG,GSUB,GPOS

pyftsubset a고딕16.ttf --unicodes="$BASE,$KS" --layout-features='' \
  --flavor=woff2 --output-file=src/fonts/agothic-700.woff2 \
  --no-hinting --desubroutinize --drop-tables+=DSIG,GSUB,GPOS
```

## 완성형 전체로 바꿔야 할 때

희귀 글자가 든 거래처명·품목명이 다른 폰트로 보이는 문제가 생기면
한글 완성형 전체를 넣는다. 용량이 235KB → 833KB(인라인 후 1.1MB)로 늘어난다.

`$KS` 대신 `U+AC00-D7A3` 을 쓰면 된다.

## 커버리지 검증

서브셋 후 실제 쓰이는 단어가 빠지지 않았는지 확인한다.

```python
from fontTools.ttLib import TTFont
cmap = set(TTFont('src/fonts/agothic-400.woff2').getBestCmap().keys())
words = ["팜넷 협동조합","미꾸야 꾸이랑","남원추어 해장국","주식회사 봉동댁",
         "그린키위","가산아스크타워","띠지","카톤박스","영세율","면세"]
missing = {c for w in words for c in w if c.strip() and ord(c) not in cmap}
print("누락:", ''.join(sorted(missing)) or "없음")
```

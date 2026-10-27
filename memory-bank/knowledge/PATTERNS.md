# Patterns

> 검증된 코드 패턴. 복붙 바로 가능한 형태로 유지.

<!-- 예시 형식:

## [패턴 이름]

**사용 시점:** [언제 이 패턴을 써야 하나]

```language
// 코드
```

-->

## H3 continuity frame calculation

- H3 output lengths use the 24 fps `17n+5` frame grid.
- For a continuation clip, generate the normal snapped clip length plus the 22-frame context prefix, then trim the prefix from the delivered result.

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - navigation [ref=e4]:
      - generic [ref=e5]:
        - link:
          - /url: /dashboard
        - link "Dashboard" [ref=e6] [cursor=pointer]:
          - /url: /dashboard
      - generic [ref=e9]: Outs
      - button "Logout" [ref=e15] [cursor=pointer]
    - paragraph [ref=e18]: Loading game...
  - generic [ref=e19]:
    - generic "Toggle devtools panel" [ref=e20] [cursor=pointer]:
      - img [ref=e21]
    - generic "Toggle Component Inspector" [ref=e26] [cursor=pointer]:
      - img [ref=e27]
```
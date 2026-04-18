---
name: Bug report
about: Something in the UI or API proxy isn't working right
title: "[bug] "
labels: bug
assignees: ''
---

**What happened**
<!-- Short: what did you do, what did you expect, what did you see? -->

**Reproduction**
1.
2.
3.

**Environment**
- Client version / commit:
- Install mode: [ ] Docker [ ] systemd [ ] manual (`uvicorn` + `npm run dev`)
- Browser + version:
- MCP server version (from `/api/health`):
- View where the bug occurred: [ ] Dashboard [ ] Fabric [ ] Console [ ] Tools [ ] Activity [ ] Settings

**Browser console logs (if UI bug)**
```
# F12 → Console, paste anything red
```

**Backend logs**
```
# docker compose logs client  OR  journalctl -u sonic-mcp-client
```

**Anything else**
<!-- screenshots, related issues, LLM provider in use, etc. -->

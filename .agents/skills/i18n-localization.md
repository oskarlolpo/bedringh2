---
name: i18n-localization
description: Standard workflow and guidelines for adding and managing localized UI strings across Bedrin frontend applications.
---

# i18n & Localization Workflow

When adding any new button, page element, title, description, or modal:

1. Add message key entry to `apps/app-frontend/src/locales/en-US/index.json`:
```json
"app.feature.element.key": {
  "message": "English Text"
}
```

2. Add corresponding translation to `apps/app-frontend/src/locales/ru-RU/index.json`:
```json
"app.feature.element.key": {
  "message": "Русский текст"
}
```

3. Reference in Vue template:
```vue
<template>
  <ButtonStyled>{{ formatMessage({ id: 'app.feature.element.key' }) }}</ButtonStyled>
</template>
```

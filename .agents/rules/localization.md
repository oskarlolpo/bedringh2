# Localization Rule & Policy

All user-visible text strings, button labels, titles, notification messages, tooltips, and prompts added to the application UI MUST be localized into the internationalization system.

## Policy Guidelines

1. **No Hardcoded English/Russian Text in UI Components**:
   - Do not hardcode UI text inside Vue/React components.
   - Use the `useVIntl` / `formatMessage` composable or `$t` helper for Vue components.

2. **Locale File Sync**:
   - Every new string key added to `apps/app-frontend/src/locales/en-US/index.json` MUST also be added to `apps/app-frontend/src/locales/ru-RU/index.json` (and other supported locales when applicable).

3. **Key Naming Convention**:
   - Standard format: `app.<component_or_page>.<sub_section>.<element_name>`
   - Example: `app.instance.worlds.empty.title` or `app.bedrock.content.categories.behavior`

4. **Verification**:
   - Check both English and Russian locale JSON files before submitting any PR or completing a feature implementation turn.

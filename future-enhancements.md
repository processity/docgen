# Future Enhancements & Optional Tasks

This document contains optional enhancement tasks that are not part of the core MVP implementation. The core system (T-01 through T-16) is complete and production-ready. These tasks represent potential future improvements.

**Status**: Optional / Backlog
**Priority**: To be determined based on business needs

---

## T-17 — Security & Compliance Hardening

**Goal**: Enforce least-privilege, AAD JWT checks, PII handling, image allowlist, and font licensing.
**Why it matters**: Reduces risk and aligns with policy.

**Prereqs/Dependencies**: T-08, T-12, T-16.

**Steps (TDD-first)**:

1. Tests: reject non-allowlisted image URLs; reject expired/incorrect `iss/aud` JWT; mask PII in logs.
2. Configure Integration User permissions: Files create/read; custom objects R/W; REST minimal scope.
3. Document retention/caching: store full `RequestJSON__c` (Shield optional encryption), template cache immutable, purge policy.

**Behavioural tests (Given/When/Then)**:

* Given a non-allowlisted CDN, When merging images, Then 400 with reason.
* Given JWT with past `exp`, Then 401.
* Given error logs, Then PII fields (e.g., emails, phone) are redacted.

**Artifacts to commit**:

* `src/security/image-allowlist.ts`
* `test/security.test.ts`
* `docs/security.md` (AAD validation: `aud/iss/exp`; scopes; Shield encryption; retention windows; font licenses)

**Definition of Done**: Policies enforced by code/tests; documentation complete.
**Timebox**: ≤2–3 days

**Progress checklist**

* [ ] JWT validations strict
* [ ] Integration User least-privilege
* [ ] PII masking & image allowlist

**PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

**Notes**:
- Many security features are already implemented (AAD JWT validation in T-08, image allowlist in T-10, Key Vault in T-16)
- This task would add additional hardening and documentation
- Consider prioritizing based on compliance requirements

---

## T-18 — Performance, Failure Injection, Rollout & DocuSign Hooks

**Goal**: Prove performance (5–10 docs/min interactive; 50k+ batch), validate failure scenarios, document rollout, and add DocuSign design hooks.
**Why it matters**: Confident release and future extensibility.

**Prereqs/Dependencies**: T-13–T-17.

**Steps (TDD-first)**:

1. Add perf tests (locally with stubs): simulate 10/min interactive and batch 50k with poller; assert SLA via timings/metrics (no real LibreOffice).
2. Failure injection: force `soffice` crash, huge tables, malformed template; assert retries/backoff; stuck lock detector runbook.
3. Add DocuSign hooks (design only): fields on `Generated_Document__c` (`DocuSignEnvelopeId__c`, `DocuSignStatus__c`), event bus placeholders, handler interface (no implementation).

**Behavioural tests (Given/When/Then)**:

* Given batch of 50,000 rows, When poller runs with concurrency=8, Then completes under planned window in stubbed mode and respects backoff for failures.
* Given a crash, Then attempt increments and next schedule matches 1m/5m/15m.
* Given hooks enabled, Then envelopeId can be set later without changing generation flow.

**Artifacts to commit**:

* `test/perf.sim.test.ts` (timing assertions using faked timers)
* `docs/runbook.md` (stuck locks, retries, dashboards, rollback strategy, feature toggles)
* `force-app/.../objects/Generated_Document__c/fields/DocuSignEnvelopeId__c` & `DocuSignStatus__c`
* `docs/extensibility-docusign.md` (webhook endpoints sketch, status machine integration points)

**Definition of Done**: Perf targets demonstrated in tests; runbooks written; DocuSign extensibility documented.
**Timebox**: ≤2–3 days

**Progress checklist**

* [ ] Perf tests + results documented
* [ ] Failure injection scenarios covered
* [ ] Runbooks and rollback plan ready
* [ ] DocuSign hooks modeled (no implementation)

**PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

**Notes**:
- Performance characteristics can be validated in staging environment with real workloads
- Failure scenarios are already covered in integration tests (T-13, T-14)
- DocuSign integration is explicitly out of scope per development-context.md section 12
- Many runbooks already exist in docs/RUNBOOKS.md from T-16
- Consider prioritizing based on actual production performance metrics

---

## Additional Enhancement Ideas

**Future tasks to consider** (not yet defined):

1. **Advanced Template Features**:
   - Support for additional output formats (HTML, Excel)
   - Advanced image manipulation (resize, crop, watermark)
   - Template validation and preview functionality
   - Template versioning and rollback

2. **Enhanced Monitoring**:
   - Custom dashboards for business metrics
   - Advanced alerting rules
   - Cost optimization recommendations
   - Performance profiling and optimization

3. **Integration Enhancements**:
   - DocuSign integration (per T-18)
   - Email delivery integration
   - Webhook support for external systems
   - Batch job scheduling UI

4. **Developer Experience**:
   - Template authoring tool/editor
   - Local development improvements
   - Testing utilities and fixtures
   - Documentation site

5. **Operational Improvements**:
   - Blue-green deployment strategy
   - Canary releases
   - A/B testing framework
   - Multi-region deployment

---

## Implementation Notes

When considering these enhancements:

1. **Prioritize based on business value**: Focus on features that deliver the most value to users
2. **Measure current state**: Collect production metrics before optimizing
3. **Incremental approach**: Implement enhancements in small, testable increments
4. **Maintain test coverage**: Follow the TDD approach established in T-01 through T-16
5. **Document decisions**: Continue using ADRs for architectural decisions
6. **Security first**: Security enhancements should be prioritized if compliance requirements change

The core system (T-01 through T-16) provides a solid foundation for these enhancements. All enhancements should build upon the existing architecture and maintain the established patterns.

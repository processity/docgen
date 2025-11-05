# ADR 0001: Runtime and Container Architecture

**Status**: Accepted
**Date**: 2025-11-05
**Decision Makers**: Architecture Team

## Context

We need to select a runtime platform and architecture for the Salesforce PDF generation service that supports:
- Document generation with DOCX templates
- PDF conversion using LibreOffice
- Both interactive (real-time) and batch processing modes
- Scalability to handle 50k+ documents
- Deployment on Azure Container Apps

## Decision

We will use **Node.js 20+ with TypeScript and Fastify** in a **single-container architecture** that runs both:
1. **HTTP API** - For interactive document generation requests from Salesforce
2. **Internal Worker (Poller)** - For batch processing of queued documents

### Key Technical Choices

**Runtime**:
- Node.js 20+ (LTS) for mature async I/O and ecosystem
- TypeScript for type safety and maintainability
- Fastify for high-performance HTTP handling with low overhead

**Container Base**:
- `debian:bookworm-slim` - Provides LibreOffice and necessary system libraries
- Single container simplifies deployment and reduces orchestration complexity

**Processing Model**:
- Internal poller runs in the same Node process as the API
- Polling interval: 15 seconds
- Concurrency limit: 8 simultaneous document jobs per instance
- Temporary working directory: `/tmp` (ephemeral, cleaned up after each job)

**Document Conversion**:
- LibreOffice (`soffice --headless`) for DOCX → PDF conversion
- Bounded worker pool (max 8 concurrent) to prevent resource exhaustion
- Per-job timeout (60 seconds) with process cleanup

## Alternatives Considered

### Alternative 1: Python + Flask/FastAPI
**Rejected**: Node.js provides better async performance for I/O-heavy workloads and has better ecosystem support for our requirements.

### Alternative 2: Separate Worker Container
**Rejected**: Adds deployment complexity and requires external queue (Redis/RabbitMQ). Single container with internal poller is simpler and sufficient for our scale (50k documents with backpressure).

### Alternative 3: Serverless Functions (Azure Functions)
**Rejected**: LibreOffice cold starts are too slow (~3-5s), and execution time limits (5-10 min) don't fit batch processing needs. Container Apps provides better control.

### Alternative 4: .NET/C#
**Rejected**: While excellent for Azure integration, Node.js has richer document processing libraries (docx-templates) and better community support for our use case.

## Consequences

### Positive
- **Simple deployment**: Single container image, no external dependencies (queues, workers)
- **Cost-effective**: No additional infrastructure for message queuing
- **Fast development**: Rich npm ecosystem for document processing
- **Easy local testing**: No external services required for development
- **Horizontal scaling**: Multiple container instances with distributed locking

### Negative
- **Resource constraints**: Must carefully manage 8-job concurrency limit
- **Single point of failure**: API and worker in same process (mitigated by multiple replicas)
- **Memory management**: Must ensure proper cleanup of LibreOffice processes

### Operational Impact
- **Monitoring**: Must track both API and worker metrics in same container
- **Deployment**: Rolling updates affect both API and worker simultaneously
- **Scaling**: Replicas scale both capabilities together (not independently)

## Implementation Notes

1. **Graceful Shutdown**: Implement proper SIGTERM handling to drain in-flight jobs
2. **Health Checks**:
   - `/healthz` - Liveness probe (always responds)
   - `/readyz` - Readiness probe (checks LibreOffice availability)
3. **Resource Limits**: 2 vCPU / 4 GB RAM per instance (Azure Container Apps)
4. **Concurrency**: Enforce strict limit of 8 concurrent LibreOffice processes

## References

- [Fastify Documentation](https://www.fastify.io/)
- [LibreOffice Headless Documentation](https://wiki.documentfoundation.org/Faq/General/017)
- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- Development Context: `development-context.md` Section 1, 5, 8

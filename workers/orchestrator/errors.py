class PipelineError(Exception):
    ...


class PipelineNotFound(PipelineError):
    ...


class ConcurrencyLimitReached(PipelineError):
    ...


class SandboxTimeout(PipelineError):
    ...


class SandboxError(PipelineError):
    ...


class ReworkLimitExceeded(PipelineError):
    ...

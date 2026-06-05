from kombu import Exchange, Queue

broker_url = "pyamqp://guest:guest@localhost:5672//"
result_backend = "redis://localhost:6379/0"

task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]

task_soft_time_limit = 580
task_hard_time_limit = 600

worker_prefetch_multiplier = 1

task_default_queue = "stas.agents.triage"

task_queues = [
    Queue("stas.agents.triage", Exchange("stas"), routing_key="stas.agents.triage"),
    Queue("stas.agents.dispatch", Exchange("stas"), routing_key="stas.agents.dispatch"),
    Queue("stas.agents.sandbox", Exchange("stas"), routing_key="stas.agents.sandbox"),
    Queue("stas.agents.verification", Exchange("stas"), routing_key="stas.agents.verification"),
    Queue("stas.agents.pr_creation", Exchange("stas"), routing_key="stas.agents.pr_creation"),
    Queue("stas.agents.notifications", Exchange("stas"), routing_key="stas.agents.notifications"),
    Queue("stas.agents.default", Exchange("stas"), routing_key="stas.agents.default"),
]

task_routes = {
    "workers.tasks.triage.*": {"queue": "stas.agents.triage"},
    "workers.tasks.agent.*": {"queue": "stas.agents.dispatch"},
    "workers.tasks.sandbox.*": {"queue": "stas.agents.sandbox"},
    "workers.tasks.verification.*": {"queue": "stas.agents.verification"},
    "workers.tasks.pr_creation.*": {"queue": "stas.agents.pr_creation"},
    "workers.tasks.notifications.*": {"queue": "stas.agents.notifications"},
}

from typing import Protocol


class Feature(Protocol):
    kind: str
    queue: str

    def run(self, task_id: str) -> None: ...

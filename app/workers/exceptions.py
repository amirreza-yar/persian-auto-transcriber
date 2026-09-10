class RetryLater(Exception):
    def __init__(self, message: str, delay_seconds: int):
        super().__init__(message)
        self.delay_seconds = delay_seconds


class JobPaused(Exception):
    pass


class JobCancelled(Exception):
    pass

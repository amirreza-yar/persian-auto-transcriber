from app.features.registry import registry


def load_features() -> None:
    if getattr(load_features, "loaded", False):
        return
    from app.features.cleaning.feature import CleaningFeature
    from app.features.transcription.feature import TranscriptionFeature

    registry.register(TranscriptionFeature())
    registry.register(CleaningFeature())
    load_features.loaded = True

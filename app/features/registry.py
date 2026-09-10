from app.features.base import Feature


class FeatureRegistry:
    def __init__(self) -> None:
        self._features: dict[str, Feature] = {}

    def register(self, feature: Feature) -> None:
        if feature.kind in self._features:
            raise RuntimeError(f"Feature already registered: {feature.kind}")
        self._features[feature.kind] = feature

    def get(self, kind: str) -> Feature:
        try:
            return self._features[kind]
        except KeyError as exc:
            raise RuntimeError(f"No feature registered for task kind: {kind}") from exc


registry = FeatureRegistry()

from django.urls import path

from . import views

urlpatterns = [
    path("info/", views.InstanceInfoView.as_view(), name="system-info"),
    path("settings/", views.InstanceSettingsView.as_view(), name="system-settings"),
    path("storage/", views.StorageInfoView.as_view(), name="system-storage"),
    path("storage/docker/", views.DockerUsageView.as_view(), name="system-docker-usage"),
    path("storage/clear-cache/", views.ClearCacheView.as_view(), name="system-clear-cache"),
    path("export/chat-history/", views.ExportChatHistoryView.as_view(), name="export-chat-history"),
    path("export/settings/", views.ExportSettingsView.as_view(), name="export-settings"),
    path("export/all/", views.ExportAllDataView.as_view(), name="export-all"),
    path("danger/reset-instance/", views.ResetInstanceView.as_view(), name="danger-reset"),
    path("danger/delete-all-data/", views.DeleteAllDataView.as_view(), name="danger-delete"),
    path("danger/factory-reset/", views.FactoryResetView.as_view(), name="danger-factory-reset"),
    path("updates/check/", views.CheckUpdateView.as_view(), name="updates-check"),
    path("updates/apply/", views.ApplyUpdateView.as_view(), name="updates-apply"),
    path("providers/test/", views.ProviderTestView.as_view(), name="provider-test"),
    path("providers/", views.ProviderListCreateView.as_view(), name="provider-list-create"),
    path("providers/<uuid:provider_id>/", views.ProviderDetailView.as_view(), name="provider-detail"),
    path("providers/<uuid:provider_id>/set-default/", views.ProviderSetDefaultView.as_view(), name="provider-set-default"),
    path("providers/<uuid:provider_id>/models/", views.ProviderModelsView.as_view(), name="provider-models"),
    path("model-config/", views.ModelConfigView.as_view(), name="model-config"),
    path("services/whisper/health/", views.WhisperHealthView.as_view(), name="whisper-health"),
    path("services/whisper/models/", views.WhisperModelsView.as_view(), name="whisper-models"),
    path("services/whisper/models/pull/", views.WhisperPullModelView.as_view(), name="whisper-pull-model"),
    path("services/whisper/models/<str:model_name>/", views.WhisperDeleteModelView.as_view(), name="whisper-delete-model"),
]

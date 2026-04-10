from django.urls import path

from . import views

urlpatterns = [
    path("info/", views.InstanceInfoView.as_view(), name="system-info"),
    path("settings/", views.InstanceSettingsView.as_view(), name="system-settings"),
    path("storage/", views.StorageInfoView.as_view(), name="system-storage"),
    path("storage/clear-cache/", views.ClearCacheView.as_view(), name="system-clear-cache"),
    path("export/chat-history/", views.ExportChatHistoryView.as_view(), name="export-chat-history"),
    path("export/settings/", views.ExportSettingsView.as_view(), name="export-settings"),
    path("export/all/", views.ExportAllDataView.as_view(), name="export-all"),
    path("danger/reset-instance/", views.ResetInstanceView.as_view(), name="danger-reset"),
    path("danger/delete-all-data/", views.DeleteAllDataView.as_view(), name="danger-delete"),
    path("danger/factory-reset/", views.FactoryResetView.as_view(), name="danger-factory-reset"),
    path("providers/test/", views.ProviderTestView.as_view(), name="provider-test"),
    path("providers/", views.ProviderListCreateView.as_view(), name="provider-list-create"),
    path("providers/<uuid:provider_id>/", views.ProviderDetailView.as_view(), name="provider-detail"),
    path("providers/<uuid:provider_id>/set-default/", views.ProviderSetDefaultView.as_view(), name="provider-set-default"),
    path("model-config/", views.ModelConfigView.as_view(), name="model-config"),
]

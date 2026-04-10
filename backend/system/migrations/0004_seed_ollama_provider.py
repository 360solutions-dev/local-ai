from django.db import migrations


def seed_ollama(apps, schema_editor):
    Provider = apps.get_model("system", "Provider")
    if not Provider.objects.filter(name="Ollama").exists():
        Provider.objects.create(
            name="Ollama",
            icon="\U0001F9E0",
            description="Local model inference with Ollama. Runs on your machine with full privacy.",
            endpoint="http://localhost:11434",
            type="ollama",
            is_default=True,
            is_connected=False,
        )


def remove_ollama(apps, schema_editor):
    Provider = apps.get_model("system", "Provider")
    Provider.objects.filter(name="Ollama", type="ollama").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0003_add_file_upload_limits"),
    ]

    operations = [
        migrations.RunPython(seed_ollama, remove_ollama),
    ]

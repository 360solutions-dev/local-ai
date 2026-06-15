import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0004_seed_ollama_provider"),
    ]

    operations = [
        migrations.AddField(
            model_name="modelconfig",
            name="chat_provider",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="system.provider",
            ),
        ),
        migrations.AddField(
            model_name="modelconfig",
            name="embedding_provider",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="system.provider",
            ),
        ),
        migrations.AddField(
            model_name="modelconfig",
            name="tts_provider",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="system.provider",
            ),
        ),
    ]

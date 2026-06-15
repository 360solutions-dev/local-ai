from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial_setup"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="recovery_code_hash",
            field=models.CharField(blank=True, max_length=128, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="recovery_code_created_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="recovery_code_used_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0002_modelconfig_provider"),
    ]

    operations = [
        migrations.AddField(
            model_name="instancesettings",
            name="max_file_size_mb",
            field=models.PositiveIntegerField(default=50),
        ),
        migrations.AddField(
            model_name="instancesettings",
            name="max_files_per_chat",
            field=models.IntegerField(default=10, help_text="0 = unlimited"),
        ),
    ]

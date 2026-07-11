# Image pipeline

Turn a folder of images into a searchable visual library with CLIP.

## What you control

- **Upload** — single images or a batch / folder.
- **Generate embeddings** — CLIP vectors per image → Qdrant.
- **Cluster** — group visually similar images (configurable minimum cluster size).
- **Search** — type a text query ("outdoor product on grass") and get a ranked grid back; the
  same CLIP encoder maps text and images into one space.

## What you get

- A searchable **image index** in Qdrant.
- **Clusters** of look-alike images and a gallery with EXIF / thumbnail metadata.
- Text-to-image **semantic search** results ranked by similarity.

## API

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/v1/images/{id}/upload` · `/upload-batch` |
| `POST` | `/api/v1/images/{id}/embeddings` · `/cluster` · `/search` |
| `GET` | `/api/v1/images/{id}/gallery` · `/clusters` |

!!! info "Phase 3.5"
    Full **Roboflow-level annotation** (bounding boxes, polygons, class labels) is the next
    milestone for the image pipeline — see the [Roadmap](../roadmap.md).

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, ArrowLeft, Search, BookOpen } from "lucide-react";
import { Link } from "wouter";

interface PhilosophicalPosition {
  id: number;
  thinker: string;
  statement: string;
  topic: string;
  source?: string;
  era?: string;
  keywords?: string;
}

export default function PositionsManager() {
  const [positions, setPositions] = useState<PhilosophicalPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    thinker: "",
    statement: "",
    topic: "",
    source: "",
    era: "",
    keywords: ""
  });

  const fetchPositions = async () => {
    try {
      const url = searchQuery 
        ? `/api/positions?search=${encodeURIComponent(searchQuery)}`
        : "/api/positions";
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      setPositions(data.positions || []);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load positions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, []);

  const handleSearch = () => {
    setLoading(true);
    fetchPositions();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.thinker || !formData.statement || !formData.topic) {
      toast({ title: "Error", description: "Thinker, statement, and topic are required", variant: "destructive" });
      return;
    }

    try {
      const res = await fetch("/api/positions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ positions: [formData] })
      });
      
      if (res.ok) {
        toast({ title: "Success", description: "Position added successfully" });
        setFormData({ thinker: "", statement: "", topic: "", source: "", era: "", keywords: "" });
        setShowForm(false);
        fetchPositions();
      } else {
        const error = await res.json();
        toast({ title: "Error", description: error.error || "Failed to add position", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to add position", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this position?")) return;
    
    try {
      const res = await fetch(`/api/positions/${id}`, { method: "DELETE", credentials: 'include' });
      if (res.ok) {
        toast({ title: "Deleted", description: "Position removed" });
        setPositions(positions.filter(p => p.id !== id));
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="link-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="w-6 h-6" />
              Philosophical Positions
            </h1>
          </div>
          <Button onClick={() => setShowForm(!showForm)} data-testid="button-add-position">
            <Plus className="w-4 h-4 mr-2" />
            Add Position
          </Button>
        </div>

        {showForm && (
          <Card className="mb-6" data-testid="card-add-form">
            <CardHeader>
              <CardTitle>Add New Position</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Thinker *</label>
                    <Input
                      placeholder="e.g., Aristotle, Kant, Wittgenstein"
                      value={formData.thinker}
                      onChange={(e) => setFormData({ ...formData, thinker: e.target.value })}
                      data-testid="input-thinker"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Topic *</label>
                    <Input
                      placeholder="e.g., ethics, metaphysics, epistemology"
                      value={formData.topic}
                      onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                      data-testid="input-topic"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Statement *</label>
                  <Textarea
                    placeholder="The philosophical position or claim..."
                    value={formData.statement}
                    onChange={(e) => setFormData({ ...formData, statement: e.target.value })}
                    rows={3}
                    data-testid="input-statement"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">Source</label>
                    <Input
                      placeholder="e.g., Nicomachean Ethics"
                      value={formData.source}
                      onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                      data-testid="input-source"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Era</label>
                    <Input
                      placeholder="e.g., Ancient, Modern"
                      value={formData.era}
                      onChange={(e) => setFormData({ ...formData, era: e.target.value })}
                      data-testid="input-era"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Keywords</label>
                    <Input
                      placeholder="e.g., virtue, happiness"
                      value={formData.keywords}
                      onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                      data-testid="input-keywords"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" data-testid="button-submit">Save Position</Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search positions by thinker, topic, or statement..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                data-testid="input-search"
              />
              <Button onClick={handleSearch} variant="outline" data-testid="button-search">
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="text-sm text-gray-500 mb-4">
          {positions.length} position{positions.length !== 1 ? "s" : ""} found
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : positions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No positions yet. Add some philosophical positions to enhance Tractatus outputs with RAG.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {positions.map((pos) => (
              <Card key={pos.id} data-testid={`card-position-${pos.id}`}>
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-blue-700">{pos.thinker}</span>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{pos.topic}</span>
                        {pos.era && <span className="text-xs text-gray-400">{pos.era}</span>}
                      </div>
                      <p className="text-gray-800">{pos.statement}</p>
                      {pos.source && <p className="text-sm text-gray-500 mt-1">Source: {pos.source}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(pos.id)}
                      className="text-red-500 hover:text-red-700"
                      data-testid={`button-delete-${pos.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
